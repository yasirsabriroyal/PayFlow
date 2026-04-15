'use client'

import { useEffect, useState } from 'react'

interface ServiceWorkerState {
  isSupported: boolean
  isRegistered: boolean
  isUpdateAvailable: boolean
  registration: ServiceWorkerRegistration | null
}

export function ServiceWorkerRegistration() {
  const [swState, setSwState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
  })

  useEffect(() => {
    // Check if service workers are supported
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.log('[PWA] Service workers not supported')
      return
    }

    setSwState(prev => ({ ...prev, isSupported: true }))

    const registerServiceWorker = async () => {
      try {
        // Register the service worker
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })

        console.log('[PWA] Service worker registered:', registration.scope)

        setSwState(prev => ({
          ...prev,
          isRegistered: true,
          registration,
        }))

        // Check for updates periodically (every hour)
        const checkForUpdates = () => {
          registration.update().catch((err) => {
            console.log('[PWA] Update check failed:', err)
          })
        }

        // Initial update check after 1 minute
        setTimeout(checkForUpdates, 60000)

        // Periodic update check
        const updateInterval = setInterval(checkForUpdates, 3600000) // 1 hour

        // Listen for new service worker waiting
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing

          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available')
                setSwState(prev => ({ ...prev, isUpdateAvailable: true }))
              }
            })
          }
        })

        // Clean up on unmount
        return () => {
          clearInterval(updateInterval)
        }
      } catch (error) {
        // Silently handle registration failures in preview/development environments
        // Common causes: redirects (preview envs), localhost without HTTPS, cross-origin issues
        if (process.env.NODE_ENV === 'production') {
          console.error('[PWA] Service worker registration failed:', error)
        }
      }
    }

    // Wait for page load to avoid blocking initial render
    if (document.readyState === 'complete') {
      registerServiceWorker()
    } else {
      window.addEventListener('load', registerServiceWorker, { once: true })
    }

    // Listen for controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] New service worker activated')
    })
  }, [])

  // Render nothing - this is just for registration
  // Could optionally render an update prompt when isUpdateAvailable is true
  return null
}

// Hook for components that need SW state
export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    setState(prev => ({ ...prev, isSupported: true }))

    navigator.serviceWorker.ready.then((registration) => {
      setState(prev => ({
        ...prev,
        isRegistered: true,
        registration,
      }))
    })
  }, [])

  const skipWaiting = () => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  const clearCache = () => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' })
    }
  }

  return {
    ...state,
    skipWaiting,
    clearCache,
  }
}
