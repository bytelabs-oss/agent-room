import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev server only: the Agentation toolbar, for pointing at elements and leaving notes for the agent.
if (import.meta.env.DEV) {
  const { Agentation } = await import('agentation')
  const host = document.body.appendChild(document.createElement('div'))
  createRoot(host).render(<Agentation endpoint="http://localhost:4747" appName="agent-room" />)
}
