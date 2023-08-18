;(function () {
  'use strict'

  var ClipboardJS = require('clipboard/dist/clipboard.js')
  var pre = document.getElementsByTagName('pre')
  for (var i = 0; i < pre.length; i++) {
    var b = document.createElement('button')
    b.className = 'clipboard'
    b.innerHTML = 'Copy <i class="fa fa-copy"></i>' // Use the Font Awesome copy icon
    if (pre[i].childNodes.length === 1 && pre[i].childNodes[0].nodeType === 3) {
      var div = document.createElement('div')
      div.textContent = pre[i].textContent
      pre[i].textContent = ''
      pre[i].appendChild(div)
    }
    pre[i].appendChild(b)
  }
  // https://symfony.com/doc/current/components/yaml/yaml_format.html
  new ClipboardJS('.clipboard', {
    target: function (b) {
      var p = b.parentNode
      return p.className.includes('highlight')
        ? p.getElementsByClassName('hljs')[0]
        : p.childNodes[0]
    },
  }).on('success', function (e) {
    e.clearSelection()
    var icon = e.trigger.querySelector('i')
    icon.className = 'fa fa-check' // Change the icon to the Font Awesome check icon
    e.trigger.removeChild(icon)
    e.trigger.textContent = '' // Add a space before "Copied" to adjust alignment
    e.trigger.appendChild(icon)
    setTimeout(function () {
      icon.className = 'fa fa-copy' // Revert back to the copy icon
      e.trigger.removeChild(icon)
      e.trigger.textContent = 'Copy ' // Revert back to "Copy" text
      e.trigger.appendChild(icon)
    }, 2000)
  })
})()
