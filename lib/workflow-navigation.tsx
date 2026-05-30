'use client'

import React, { createContext, useContext, useCallback, useEffect, useState, ReactNode } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

// =====================================================
// TYPES
// =====================================================

export interface NavigationEntry {
  path: string
  title?: string
  params?: Record<string, string>
  timestamp: number
}

export interface ListState {
  filters?: Record<string, string | string[] | boolean | number>
  search?: string
  activeTab?: string
  page?: number
  scrollPosition?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface WorkflowState {
  stack: NavigationEntry[]
  listStates: Record<string, ListState>
  currentWorkflow?: string
}

interface WorkflowNavigationContextValue {
  // Navigation stack
  stack: NavigationEntry[]
  currentEntry: NavigationEntry | null
  previousEntry: NavigationEntry | null
  
  // Core navigation functions
  navigateTo: (path: string, options?: { title?: string; params?: Record<string, string>; replace?: boolean }) => void
  goBack: () => void
  goBackToList: () => void
  goHome: () => void
  
  // List state management
  saveListState: (key: string, state: ListState) => void
  getListState: (key: string) => ListState | null
  clearListState: (key: string) => void
  
  // Workflow management
  startWorkflow: (name: string, initialPath: string) => void
  endWorkflow: () => void
  isInWorkflow: boolean
  currentWorkflow: string | null
  
  // Breadcrumb support
  getBreadcrumbs: () => NavigationEntry[]
  
  // Utility
  canGoBack: boolean
  clearStack: () => void
}

const STORAGE_KEY = 'payflow_workflow_nav'
const MAX_STACK_SIZE = 20

// =====================================================
// CONTEXT
// =====================================================

const WorkflowNavigationContext = createContext<WorkflowNavigationContextValue | null>(null)

// =====================================================
// STORAGE HELPERS
// =====================================================

function loadState(): WorkflowState {
  if (typeof window === 'undefined') {
    return { stack: [], listStates: {} }
  }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('[WorkflowNav] Failed to load state:', e)
  }
  return { stack: [], listStates: {} }
}

function saveState(state: WorkflowState): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('[WorkflowNav] Failed to save state:', e)
  }
}

// =====================================================
// ROUTE HELPERS
// =====================================================

// Determine if a path is a "list" page (ends in /projects, /invoices, etc.)
function isListPath(path: string): boolean {
  const listPatterns = [
    /\/dashboard$/,
    /\/projects$/,
    /\/contractors$/,
    /\/invoices$/,
    /\/certificates$/,
    /\/payments$/,
    /\/approvals$/,
    /\/queue$/,
    /\/holdbacks$/,
    /\/team$/,
    /\/reports$/,
  ]
  return listPatterns.some(pattern => pattern.test(path))
}

// Determine if a path is a "detail" page (has an ID segment)
function isDetailPath(path: string): boolean {
  // Matches paths like /pm/projects/[uuid] or /invoices/[uuid]
  const uuidPattern = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  return uuidPattern.test(path)
}

// Find the parent list path for a detail path
function getParentListPath(path: string): string | null {
  // Remove the last segment (which should be the ID or /new)
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) return null
  
  // If last segment is 'new', remove it
  if (segments[segments.length - 1] === 'new') {
    segments.pop()
  }
  // If last segment looks like a UUID, remove it
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segments[segments.length - 1])) {
    segments.pop()
  }
  
  return '/' + segments.join('/')
}

// Get role-based dashboard path
function getDashboardPath(path: string): string {
  if (path.startsWith('/pm/')) return '/pm/dashboard'
  if (path.startsWith('/accountant/')) return '/accountant/queue'
  if (path.startsWith('/admin/')) return '/admin/dashboard'
  if (path.startsWith('/vendor/') || path.startsWith('/contractor/')) return '/vendor/portal'
  if (path.startsWith('/invoices/')) return '/pm/dashboard' // Invoice hub defaults to PM
  return '/pm/dashboard'
}

// =====================================================
// PROVIDER
// =====================================================

interface WorkflowNavigationProviderProps {
  children: ReactNode
}

export function WorkflowNavigationProvider({ children }: WorkflowNavigationProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const [state, setState] = useState<WorkflowState>({ stack: [], listStates: {} })
  const [mounted, setMounted] = useState(false)

  // Load state on mount
  useEffect(() => {
    setState(loadState())
    setMounted(true)
  }, [])

  // Track navigation changes
  useEffect(() => {
    if (!mounted || !pathname) return
    
    const currentPath = pathname
    const lastEntry = state.stack[state.stack.length - 1]
    
    // Don't add duplicate entries
    if (lastEntry?.path === currentPath) return
    
    // Check if we're going back (the path matches a previous entry)
    const existingIndex = state.stack.findIndex(entry => entry.path === currentPath)
    
    if (existingIndex !== -1 && existingIndex < state.stack.length - 1) {
      // We navigated back - trim the stack
      const newStack = state.stack.slice(0, existingIndex + 1)
      const newState = { ...state, stack: newStack }
      setState(newState)
      saveState(newState)
    } else {
      // New navigation - add to stack
      const newEntry: NavigationEntry = {
        path: currentPath,
        timestamp: Date.now(),
      }
      
      let newStack = [...state.stack, newEntry]
      
      // Trim stack if too large
      if (newStack.length > MAX_STACK_SIZE) {
        newStack = newStack.slice(-MAX_STACK_SIZE)
      }
      
      const newState = { ...state, stack: newStack }
      setState(newState)
      saveState(newState)
    }
  }, [pathname, mounted])

  // Navigation functions
  const navigateTo = useCallback((
    path: string, 
    options?: { title?: string; params?: Record<string, string>; replace?: boolean }
  ) => {
    const entry: NavigationEntry = {
      path,
      title: options?.title,
      params: options?.params,
      timestamp: Date.now(),
    }
    
    if (options?.replace && state.stack.length > 0) {
      const newStack = [...state.stack.slice(0, -1), entry]
      const newState = { ...state, stack: newStack }
      setState(newState)
      saveState(newState)
      router.replace(path)
    } else {
      router.push(path)
    }
  }, [router, state])

  const goBack = useCallback(() => {
    if (state.stack.length > 1) {
      const previousEntry = state.stack[state.stack.length - 2]
      router.push(previousEntry.path)
    } else {
      // Fallback to dashboard
      router.push(getDashboardPath(pathname || ''))
    }
  }, [state.stack, router, pathname])

  const goBackToList = useCallback(() => {
    // Find the most recent list page in the stack
    for (let i = state.stack.length - 2; i >= 0; i--) {
      if (isListPath(state.stack[i].path)) {
        router.push(state.stack[i].path)
        return
      }
    }
    
    // If no list page found, try to determine from current path
    const parentList = getParentListPath(pathname || '')
    if (parentList) {
      router.push(parentList)
      return
    }
    
    // Fallback to dashboard
    router.push(getDashboardPath(pathname || ''))
  }, [state.stack, router, pathname])

  const goHome = useCallback(() => {
    const dashboardPath = getDashboardPath(pathname || '')
    // Clear stack when going home
    const newState = { ...state, stack: [], currentWorkflow: undefined }
    setState(newState)
    saveState(newState)
    router.push(dashboardPath)
  }, [router, pathname, state])

  // List state management
  const saveListState = useCallback((key: string, listState: ListState) => {
    const newState = {
      ...state,
      listStates: {
        ...state.listStates,
        [key]: { ...listState, scrollPosition: typeof window !== 'undefined' ? window.scrollY : 0 }
      }
    }
    setState(newState)
    saveState(newState)
  }, [state])

  const getListState = useCallback((key: string): ListState | null => {
    return state.listStates[key] || null
  }, [state.listStates])

  const clearListState = useCallback((key: string) => {
    const { [key]: _, ...rest } = state.listStates
    const newState = { ...state, listStates: rest }
    setState(newState)
    saveState(newState)
  }, [state])

  // Workflow management
  const startWorkflow = useCallback((name: string, initialPath: string) => {
    const newState = {
      ...state,
      currentWorkflow: name,
      stack: [{
        path: initialPath,
        title: name,
        timestamp: Date.now(),
      }]
    }
    setState(newState)
    saveState(newState)
    router.push(initialPath)
  }, [state, router])

  const endWorkflow = useCallback(() => {
    const newState = { ...state, currentWorkflow: undefined }
    setState(newState)
    saveState(newState)
    goHome()
  }, [state, goHome])

  // Breadcrumb support
  const getBreadcrumbs = useCallback((): NavigationEntry[] => {
    // Return last 3-4 entries for breadcrumbs
    return state.stack.slice(-4)
  }, [state.stack])

  const clearStack = useCallback(() => {
    const newState = { ...state, stack: [] }
    setState(newState)
    saveState(newState)
  }, [state])

  const value: WorkflowNavigationContextValue = {
    stack: state.stack,
    currentEntry: state.stack[state.stack.length - 1] || null,
    previousEntry: state.stack[state.stack.length - 2] || null,
    
    navigateTo,
    goBack,
    goBackToList,
    goHome,
    
    saveListState,
    getListState,
    clearListState,
    
    startWorkflow,
    endWorkflow,
    isInWorkflow: !!state.currentWorkflow,
    currentWorkflow: state.currentWorkflow || null,
    
    getBreadcrumbs,
    
    // Only report canGoBack as true after mount to avoid hydration issues
    canGoBack: mounted && state.stack.length > 1,
    clearStack,
  }

  return (
    <WorkflowNavigationContext.Provider value={value}>
      {children}
    </WorkflowNavigationContext.Provider>
  )
}

// =====================================================
// HOOK
// =====================================================

export function useWorkflowNavigation() {
  const context = useContext(WorkflowNavigationContext)
  
  if (!context) {
    // Return a fallback for when not wrapped in provider
    // This allows gradual adoption
    return {
      stack: [],
      currentEntry: null,
      previousEntry: null,
      navigateTo: () => {},
      goBack: () => typeof window !== 'undefined' && window.history.back(),
      goBackToList: () => typeof window !== 'undefined' && window.history.back(),
      goHome: () => {},
      saveListState: () => {},
      getListState: () => null,
      clearListState: () => {},
      startWorkflow: () => {},
      endWorkflow: () => {},
      isInWorkflow: false,
      currentWorkflow: null,
      getBreadcrumbs: () => [],
      canGoBack: false,
      clearStack: () => {},
    } as WorkflowNavigationContextValue
  }
  
  return context
}

// =====================================================
// UTILITY HOOKS
// =====================================================

/**
 * Hook to automatically save and restore list state for a page
 * Supports: filters, search, active tabs, pagination, scroll position
 */
export function useListStatePreservation(key: string, autoSaveOnUnmount = true) {
  const { saveListState, getListState } = useWorkflowNavigation()
  const [restored, setRestored] = useState(false)
  const stateRef = React.useRef<ListState>({})
  const keyRef = React.useRef(key)
  const saveListStateRef = React.useRef(saveListState)
  
  // Keep refs up to date
  keyRef.current = key
  saveListStateRef.current = saveListState
  
  // Get initial state on mount - memoize to prevent recalculation
  const initialState = React.useMemo(() => getListState(key), [])
  
  // Mark as restored after first render and restore scroll position
  useEffect(() => {
    setRestored(true)
    
    // Restore scroll position if available
    if (initialState?.scrollPosition && typeof window !== 'undefined') {
      setTimeout(() => {
        window.scrollTo(0, initialState.scrollPosition!)
      }, 100)
    }
  }, [])
  
  // Auto-save on unmount only
  useEffect(() => {
    return () => {
      if (autoSaveOnUnmount && typeof window !== 'undefined') {
        // Save current scroll position along with other state
        saveListStateRef.current(keyRef.current, {
          ...stateRef.current,
          scrollPosition: window.scrollY
        })
      }
    }
  }, [autoSaveOnUnmount])
  
  // Stable save function that doesn't change reference
  const save = useCallback((state: ListState) => {
    stateRef.current = { ...stateRef.current, ...state }
    // Only save to ref, actual persistence happens on unmount
    // This prevents infinite loops when save is in useEffect dependencies
  }, [])
  
  // Update a single field
  const update = useCallback(<K extends keyof ListState>(field: K, value: ListState[K]) => {
    stateRef.current = { ...stateRef.current, [field]: value }
  }, [])
  
  // Batch update multiple fields
  const updateMultiple = useCallback((updates: Partial<ListState>) => {
    stateRef.current = { ...stateRef.current, ...updates }
  }, [])

  // Force save now (for explicit saves outside of unmount)
  const saveNow = useCallback(() => {
    if (typeof window !== 'undefined') {
      saveListStateRef.current(keyRef.current, {
        ...stateRef.current,
        scrollPosition: window.scrollY
      })
    }
  }, [])
  
  return {
    initialState,
    save,
    saveNow,
    update,
    updateMultiple,
    restored,
  }
}

/**
 * Hook to get contextual back behavior
 */
export function useContextualBack() {
  const { goBack, goBackToList, canGoBack, previousEntry } = useWorkflowNavigation()
  const pathname = usePathname()
  
  const handleBack = useCallback(() => {
    if (canGoBack) {
      goBack()
    } else if (typeof window !== 'undefined') {
      window.history.back()
    }
  }, [canGoBack, goBack])
  
  const handleBackToList = useCallback(() => {
    goBackToList()
  }, [goBackToList])
  
  return {
    goBack: handleBack,
    goBackToList: handleBackToList,
    canGoBack,
    previousPath: previousEntry?.path || null,
    isOnDetailPage: isDetailPath(pathname || ''),
    isOnListPage: isListPath(pathname || ''),
  }
}
