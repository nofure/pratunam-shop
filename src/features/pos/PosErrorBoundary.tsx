import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button, EmptyState } from '../../ui'

interface State {
  failed: boolean
}

/** Keeps a crash in one screen from blanking the whole app; offers a reload. */
export default class PosErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[pos] screen crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page">
        <EmptyState
          icon={<TriangleAlert size={28} />}
          title="หน้านี้โหลดไม่สำเร็จ"
          hint="บิลที่บันทึกไว้แล้วยังอยู่ครบ ลองโหลดหน้าใหม่"
          action={
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
              โหลดใหม่
            </Button>
          }
        />
      </div>
    )
  }
}
