import { MongoClient, MongoClientOptions, ReadPreference } from 'mongodb'
import { Client as SshClient } from 'ssh2'
import { createServer, Server, AddressInfo } from 'net'
import { promises as fs } from 'fs'
import { EventEmitter } from 'events'
import { ConnectionConfig, ConnectionStatusEvent, ServerInfo } from '@shared/types'

interface SshTunnel {
  ssh: SshClient
  server: Server
  localPort: number
}

export interface Session {
  config: ConnectionConfig
  client: MongoClient
  tunnel?: SshTunnel
  serverInfo: ServerInfo
}

/**
 * Owns live MongoClient instances (and their SSH tunnels) keyed by connection id.
 * Mirrors Robo3T's behaviour: one client per saved connection, opened on demand.
 */
export class ClientManager extends EventEmitter {
  private sessions = new Map<string, Session>()

  get(id: string): Session {
    const s = this.sessions.get(id)
    if (!s) throw new Error('Not connected')
    return s
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  private emitStatus(ev: ConnectionStatusEvent): void {
    this.emit('status', ev)
  }

  async connect(config: ConnectionConfig): Promise<ServerInfo> {
    if (this.sessions.has(config.id)) return this.sessions.get(config.id)!.serverInfo
    this.emitStatus({ connectionId: config.id, state: 'connecting' })
    try {
      const session = await this.open(config)
      this.sessions.set(config.id, session)
      session.client.on('close', () => {
        if (this.sessions.get(config.id) === session) {
          this.sessions.delete(config.id)
          this.emitStatus({ connectionId: config.id, state: 'disconnected' })
        }
      })
      this.emitStatus({ connectionId: config.id, state: 'connected' })
      return session.serverInfo
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emitStatus({ connectionId: config.id, state: 'error', error: message })
      throw err
    }
  }

  /** Connect, run isMaster/buildInfo, then tear down. Used by the "Test" button. */
  async test(config: ConnectionConfig): Promise<ServerInfo> {
    const session = await this.open(config)
    await this.close(session)
    return session.serverInfo
  }

  async disconnect(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    await this.close(session)
    this.emitStatus({ connectionId: id, state: 'disconnected' })
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)))
  }

  private async close(session: Session): Promise<void> {
    try {
      await session.client.close(true)
    } catch {
      /* ignore */
    }
    if (session.tunnel) {
      session.tunnel.server.close()
      session.tunnel.ssh.end()
    }
  }

  private async open(config: ConnectionConfig): Promise<Session> {
    let tunnel: SshTunnel | undefined
    try {
      let uri: string
      const options: MongoClientOptions = {
        connectTimeoutMS: config.advanced.connectTimeoutMs || 10000,
        serverSelectionTimeoutMS: config.advanced.connectTimeoutMs || 10000,
        appName: 'MongoBrowser'
      }

      if (config.type === 'uri') {
        uri = config.uri.trim()
      } else {
        let hosts: string
        if (config.ssh.enabled) {
          // Robo3T tunnels a single host:port through SSH and talks to it directly.
          const target = config.type === 'replicaSet' && config.members[0] ? config.members[0] : { host: config.host, port: config.port }
          tunnel = await openTunnel(config, target.host, target.port)
          hosts = `127.0.0.1:${tunnel.localPort}`
          options.directConnection = true
        } else if (config.type === 'replicaSet') {
          hosts = config.members.map((m) => `${m.host}:${m.port}`).join(',')
          if (config.replicaSetName) options.replicaSet = config.replicaSetName
        } else {
          hosts = `${config.host}:${config.port}`
          options.directConnection = true
        }
        uri = `mongodb://${hosts}/`

        if (config.auth.enabled) {
          options.auth = { username: config.auth.username, password: config.auth.password }
          options.authSource = config.auth.database || 'admin'
          if (config.auth.mechanism) options.authMechanism = config.auth.mechanism
          if (config.auth.mechanism === 'MONGODB-X509') delete (options.auth as { password?: string }).password
        }
        if (config.tls.enabled) {
          options.tls = true
          if (config.tls.caFile) options.ca = await fs.readFile(config.tls.caFile)
          if (config.tls.certFile) options.cert = await fs.readFile(config.tls.certFile)
          if (config.tls.keyFile) options.key = await fs.readFile(config.tls.keyFile)
          if (config.tls.keyPassword) options.passphrase = config.tls.keyPassword
          options.tlsAllowInvalidCertificates = config.tls.allowInvalidCertificates
          options.tlsAllowInvalidHostnames = config.tls.allowInvalidHostnames
        }
        if (config.advanced.readPreference) options.readPreference = config.advanced.readPreference as ReadPreference['mode']
      }

      const client = new MongoClient(uri, options)
      await client.connect()
      const serverInfo = await describeServer(client)
      return { config, client, tunnel, serverInfo }
    } catch (err) {
      if (tunnel) {
        tunnel.server.close()
        tunnel.ssh.end()
      }
      throw err
    }
  }
}

async function describeServer(client: MongoClient): Promise<ServerInfo> {
  const admin = client.db('admin')
  const [hello, build] = await Promise.all([admin.command({ hello: 1 }), admin.command({ buildInfo: 1 })])
  const topology = hello.setName ? 'replicaSet' : hello.msg === 'isdbgrid' ? 'sharded' : 'standalone'
  return {
    version: String(build.version ?? '?'),
    host: String(hello.me ?? ''),
    replicaSet: hello.setName ? String(hello.setName) : undefined,
    isWritablePrimary: Boolean(hello.isWritablePrimary ?? hello.ismaster),
    topology
  }
}

/** Open an SSH connection and a local TCP listener that forwards every socket to targetHost:targetPort. */
async function openTunnel(config: ConnectionConfig, targetHost: string, targetPort: number): Promise<SshTunnel> {
  const ssh = new SshClient()
  const sshConfig: Record<string, unknown> = {
    host: config.ssh.host,
    port: config.ssh.port || 22,
    username: config.ssh.username,
    readyTimeout: config.advanced.connectTimeoutMs || 10000
  }
  if (config.ssh.method === 'privateKey') {
    sshConfig.privateKey = await fs.readFile(config.ssh.privateKeyPath.replace(/^~/, process.env.HOME ?? ''))
    if (config.ssh.passphrase) sshConfig.passphrase = config.ssh.passphrase
  } else {
    sshConfig.password = config.ssh.password
  }

  await new Promise<void>((resolve, reject) => {
    ssh.once('ready', resolve)
    ssh.once('error', reject)
    ssh.connect(sshConfig)
  })

  const server = createServer((socket) => {
    ssh.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, targetHost, targetPort, (err, stream) => {
      if (err) {
        socket.destroy(err)
        return
      }
      socket.pipe(stream).pipe(socket)
      stream.on('error', () => socket.destroy())
      socket.on('error', () => stream.destroy())
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const localPort = (server.address() as AddressInfo).port
  return { ssh, server, localPort }
}
