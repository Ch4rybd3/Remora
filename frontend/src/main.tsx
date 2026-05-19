import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { CurrentCaseProvider } from './context/CurrentCaseContext'
import { TimezoneProvider } from './context/TimezoneContext'
import App from './App'
import './index.css'
import '@xyflow/react/dist/style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimezoneProvider>
          <AuthProvider>
            <CurrentCaseProvider>
              <App />
            </CurrentCaseProvider>
          </AuthProvider>
        </TimezoneProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
