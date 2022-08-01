'use strict'

window.onscroll = function () {
  if (document.documentElement.scrollTop > 125) {
    document.getElementById('topbar').style.height = '3.95rem'
  } else {
    document.getElementById('topbar').style.height = '5rem'
  }
}
