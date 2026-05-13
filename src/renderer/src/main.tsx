import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Apply saved theme before first render to prevent flash
;(function () {
  const t = localStorage.getItem('desktopst.colorTheme')
  if (t && t !== 'mint') document.documentElement.setAttribute('data-color-theme', t)
})()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
