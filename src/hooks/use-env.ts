import { useEffect, useState } from 'react'
import { ENV_OPTIONS, type Env } from '#/components/env-select'

const STORAGE_KEY = 'env'
const DEFAULT_ENV: Env = 'main'

function isEnv(v: unknown): v is Env {
  return typeof v === 'string' && (ENV_OPTIONS as readonly string[]).includes(v)
}

export function useEnv(): [Env, (next: Env) => void] {
  const [env, setEnvState] = useState<Env>(DEFAULT_ENV)
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isEnv(stored)) setEnvState(stored)
  }, [])
  const setEnv = (next: Env) => {
    setEnvState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }
  return [env, setEnv]
}
