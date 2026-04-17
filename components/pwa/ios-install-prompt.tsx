'use client'

import { useState, useEffect } from 'react'
import { X, Share, Plus, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Detect in-app browsers that don't support PWA installation
function isInAppBrowser(): boolean {
  if (typeof window === 'undefined') return false
  
  const userAgent = window.navigator.userAgent.toLowerCase()
  
  // Common in-app browser identifiers
  const inAppBrowserPatterns = [
    'fban',           // Facebook App
    'fbav',           // Facebook App (Android)
    'fbios',          // Facebook App (iOS)
    'fb_iab',         // Facebook In-App Browser
    'instagram',      // Instagram
    'linkedin',       // LinkedIn
    'twitter',        // Twitter/X
    'line',           // LINE
    'wechat',         // WeChat
    'weibo',          // Weibo
    'micromessenger', // WeChat (alternate)
    'snapchat',       // Snapchat
    'pinterest',      // Pinterest
    'tiktok',         // TikTok
    'bytedance',      // TikTok (alternate)
    'reddit',         // Reddit
    'discord',        // Discord
    'slack',          // Slack
    'telegram',       // Telegram
    'whatsapp',       // WhatsApp
    'messenger',      // Facebook Messenger
    'gsa/',           // Google Search App
    'duckduckgo',     // DuckDuckGo browser
    'webview',        // Generic WebView
    'wv)',            // Android WebView
  ]
  
  // Check if any pattern matches
  return inAppBrowserPatterns.some(pattern => userAgent.includes(pattern))
}

export function IOSInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [isInApp, setIsInApp] = useState(false)

  useEffect(() => {
    // Check if running in an in-app browser (can't install PWA from these)
    const inAppBrowser = isInAppBrowser()
    setIsInApp(inAppBrowser)
    
    if (inAppBrowser) {
      // Don't show install prompt in in-app browsers
      return
    }
    
    // Check if running on iOS Safari
    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent)
    
    // Must be Safari (not Chrome, Firefox, or other iOS browsers)
    const isSafari = /safari/.test(userAgent) && 
                     !/chrome|crios|fxios|opera|opr|edge|edgios|brave/.test(userAgent)
    
    // Check if already running as standalone PWA
    const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || ('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
    
    setIsIOS(isIOSDevice && isSafari)
    setIsStandalone(isRunningStandalone)

    // Check if user has dismissed the prompt before
    const hasDismissed = localStorage.getItem('pwa-ios-prompt-dismissed')
    if (hasDismissed) {
      setDismissed(true)
    }

    // Show prompt after a short delay for iOS Safari users who haven't installed
    if (isIOSDevice && isSafari && !isRunningStandalone && !hasDismissed) {
      const timer = setTimeout(() => {
        setShowPrompt(true)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleDismiss = () => {
    setShowPrompt(false)
    setDismissed(true)
    localStorage.setItem('pwa-ios-prompt-dismissed', 'true')
  }

  const handleRemindLater = () => {
    setShowPrompt(false)
    // Will show again on next visit
  }

  // Don't render if: in-app browser, not iOS Safari, already installed, or dismissed
  if (isInApp || !isIOS || isStandalone || dismissed) {
    return null
  }

  return (
    <>
      {/* Floating Install Button */}
      {!showPrompt && (
        <button
          onClick={() => setShowPrompt(true)}
          className="fixed bottom-20 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all animate-in slide-in-from-bottom-4 md:hidden"
        >
          <Smartphone className="w-5 h-5" />
          <span className="text-sm font-medium">Install App</span>
        </button>
      )}

      {/* Install Instructions Modal */}
      <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
        <DialogContent className="sm:max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <span>Install PayFlow AP</span>
            </DialogTitle>
            <DialogDescription>
              Add this app to your home screen for the best experience
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-4">
              {/* Step 1 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-primary">1</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Tap the Share button</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-8 h-8 bg-background border border-border rounded-lg flex items-center justify-center">
                      <Share className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground">at the bottom of Safari</span>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-primary">2</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Scroll and tap &ldquo;Add to Home Screen&rdquo;</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-8 h-8 bg-background border border-border rounded-lg flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="text-xs text-muted-foreground">in the share menu</span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-primary">3</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Tap &ldquo;Add&rdquo; in the top right</p>
                  <span className="text-xs text-muted-foreground">The app will appear on your home screen</span>
                </div>
              </div>
            </div>

            <div className="bg-success/5 border border-success/20 rounded-lg p-3">
              <p className="text-xs text-success">
                <strong>Benefits:</strong> Faster access, works offline, and looks like a native app!
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleRemindLater}>
              Maybe Later
            </Button>
            <Button className="flex-1" onClick={handleDismiss}>
              Got it!
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
