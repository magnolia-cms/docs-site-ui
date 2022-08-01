;(function () {
  'use strict'

  var ClipboardJS = require('clipboard/dist/clipboard.js')
  var pre = document.getElementsByTagName('pre')
  for (var i = 0; i < pre.length; i++) {
    var b = document.createElement('button')
    b.className = 'clipboard'
    b.textContent = 'Copy'
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
    e.trigger.textContent = 'Copied'
    setTimeout(function () {
      e.trigger.textContent = 'Copy'
    }, 2000)
  })
})()
