'use strict'

const { spawn } = require('child_process')
const path = require('path')

module.exports = () => (done) => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'generate-dummy-search-data.js')
  const child = spawn('node', [scriptPath], { stdio: 'inherit' })

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Dummy search data generation failed with code ${code}`)
      // Don't fail the build - dummy data is optional
    }
    done()
  })

  child.on('error', (err) => {
    console.error('Failed to generate dummy search data:', err)
    // Don't fail the build - dummy data is optional
    done()
  })
}
