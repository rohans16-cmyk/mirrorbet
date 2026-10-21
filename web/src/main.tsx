import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AskHost } from '@/components/ui/ask'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AskHost />
  </StrictMode>,
)
