import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { getTeamOs4Deployment, hasTeamOs4DeploymentEnvironment } from './lib/deployment'
import './styles.css'

if (hasTeamOs4DeploymentEnvironment()) {
  const deployment = getTeamOs4Deployment()
  document.documentElement.dataset.teamOsVersion = deployment.productVersion
  document.documentElement.dataset.releaseVersion = deployment.releaseVersion
  document.documentElement.dataset.deploymentStage = deployment.stage
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
