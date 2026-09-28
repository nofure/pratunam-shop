// Owner reports, mounted at /reports/* (wrapped in OwnerOnly by App.tsx).
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button, EmptyState } from '../../ui'
import ReportsPage from './ReportsPage'

interface BoundaryProps {
  children: ReactNode
  onRetry: () => void
}

/** A failed database read or a broken record must not blank the whole app. */
class ReportsErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('reports: render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <EmptyState
          icon={<TriangleAlert size={28} />}
          title="เปิดรายงานไม่สำเร็จ"
          hint="ข้อมูลในเครื่องยังอยู่ครบ ลองเปิดใหม่อีกครั้ง ถ้ายังไม่ได้ให้ปิดแอปแล้วเปิดใหม่"
          action={
            <Button variant="primary" icon={<RefreshCw size={20} />} onClick={this.props.onRetry}>
              ลองใหม่
            </Button>
          }
        />
      </div>
    )
  }
}

export default function ReportsRoutes() {
  const [attempt, setAttempt] = useState(0)
  return (
    <ReportsErrorBoundary key={attempt} onRetry={() => setAttempt((a) => a + 1)}>
      <Routes>
        <Route index element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/reports" replace />} />
      </Routes>
    </ReportsErrorBoundary>
  )
}
