import { useEffect, useState } from 'react'

export function navigate(path: string) {
  if (location.pathname === path) return
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}
