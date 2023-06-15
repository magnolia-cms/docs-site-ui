;(function () {
  'use strict'

  var videoBtn = document.querySelector(".play-video");

  videoBtn.addEventListener("click", function(e) {
    e.target.parentElement.classList.add("hide");
    e.target.parentElement.nextElementSibling.play();
  })
})();
