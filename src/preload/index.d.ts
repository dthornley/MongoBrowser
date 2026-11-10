import type { MongoBrowserApi } from '@shared/types'

declare global {
  interface Window {
    api: MongoBrowserApi
    menuEvents: { on(cb: (name: string) => void): () => void }
  }
}

export {}
