/**
 * bias-bar.js — Global single-tick bias bar for Podlens
 * Usage: renderBiasBar(score, containerId)
 *   score: -100 (far left) to +100 (far right)
 *   containerId: id of the element to render into
 *
 * LEFT = Blue (#3B82F6), CENTER = Grey (#9CA3AF), RIGHT = Red (#EF4444)
 */

(function (global) {
  'use strict';

  var BIAS_CSS_ID = 'pl-bias-bar-css';

  function injectCSS() {
    if (document.getElementById(BIAS_CSS_ID)) return;
    var s = document.createElement('style');
    s.id = BIAS_CSS_ID;
    s.textContent = [
      '.bias-bar-track{width:100%;height:12px;border-radius:999px;background:linear-gradient(to right,#3B82F6,#9CA3AF,#EF4444);position:relative;overflow:visible}',
      '.bias-bar-tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:4px;height:20px;background:#fff;border-radius:2px;box-shadow:0 0 4px rgba(0,0,0,0.35);pointer-events:none}',
    ].join('');
    document.head.appendChild(s);
  }

  /**
   * @param {number} score  -100 (far left) to +100 (far right)
   * @param {string} containerId  target element id
   */
  function renderBiasBar(score, containerId) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { renderBiasBar(score, containerId); });
      return;
    }
    injectCSS();
    var container = document.getElementById(containerId);
    if (!container) return;
    // Clamp score and convert to 0-100 pct
    var s = typeof score === 'number' ? Math.max(-100, Math.min(100, score)) : 0;
    var pct = ((s + 100) / 200) * 100;
    container.innerHTML =
      '<div class="bias-bar-track">'
      + '<div class="bias-bar-tick" style="left:' + pct.toFixed(1) + '%"></div>'
      + '</div>';
  }

  global.renderBiasBar = renderBiasBar;
})(typeof window !== 'undefined' ? window : this);
