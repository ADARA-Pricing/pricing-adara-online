import { NextResponse } from "next/server";

const script = `
(function () {
  var scriptEl = document.currentScript;
  var origin = scriptEl && scriptEl.getAttribute("data-adara-origin") || "https://pricing-adara-online.vercel.app";
  var isHome = location.pathname === "/" || location.pathname === "" || /^\\/[a-z]{2}(-[A-Z]{2})?\\/?$/.test(location.pathname);
  if (!isHome || document.getElementById("adara-campaign-carousel")) return;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function normalizeOpacity(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0.28;
    return Math.max(0, Math.min(0.75, number));
  }

  function bannerImage(banner) {
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches && banner.mobile_image_url) {
      return banner.mobile_image_url;
    }
    return banner.image_url;
  }

  function render(banners) {
    if (!Array.isArray(banners) || !banners.length) return;
    var existingCarousel = document.querySelector(".template-home .adara-main-carousel, .adara-main-carousel, [data-adara-carousel]");
    var root = document.createElement("section");
    root.id = "adara-campaign-carousel";
    root.className = "adara-campaign-carousel";
    root.innerHTML = [
      '<style>',
      '#adara-campaign-carousel{position:relative;width:100%;overflow:hidden;background:#111;margin:0 0 24px;isolation:isolate}',
      '#adara-campaign-carousel .adara-track{display:flex;transition:transform .45s ease;will-change:transform}',
      '#adara-campaign-carousel .adara-slide{min-width:100%;position:relative;display:block;color:var(--adara-text,#fff);text-decoration:none}',
      '#adara-campaign-carousel .adara-slide img{display:block!important;width:100%!important;height:auto!important;max-height:none!important;object-fit:contain!important;object-position:center center!important;background:#111}',
      '#adara-campaign-carousel .adara-overlay{position:absolute;inset:0;background:#000;opacity:var(--adara-overlay,.28);pointer-events:none}',
      '#adara-campaign-carousel .adara-copy{position:absolute;inset:auto auto 10% 6%;max-width:min(560px,80vw);z-index:2;color:var(--adara-text,#fff);text-shadow:0 2px 14px rgba(0,0,0,.35)}',
      '#adara-campaign-carousel .adara-copy h2{margin:0 0 8px;font-size:clamp(28px,4vw,56px);line-height:1.02;font-weight:800;letter-spacing:0}',
      '#adara-campaign-carousel .adara-copy p{margin:0 0 18px;font-size:clamp(15px,1.6vw,20px);line-height:1.35}',
      '#adara-campaign-carousel .adara-button{display:inline-flex;align-items:center;min-height:42px;padding:0 18px;border-radius:6px;background:#fff;color:#111;font-weight:700;text-shadow:none}',
      '#adara-campaign-carousel .adara-dots{position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:8px;z-index:3}',
      '#adara-campaign-carousel .adara-dot{width:9px;height:9px;border:0;border-radius:999px;background:rgba(255,255,255,.55);padding:0;cursor:pointer}',
      '#adara-campaign-carousel .adara-dot.active{background:#fff}',
      '@media(max-width:720px){#adara-campaign-carousel{margin-bottom:16px}#adara-campaign-carousel .adara-copy{left:18px;right:18px;bottom:24px;max-width:none}}',
      '</style>',
      '<div class="adara-track">',
      banners.map(function (banner) {
        var image = escapeHtml(bannerImage(banner));
        var title = escapeHtml(banner.title);
        var subtitle = escapeHtml(banner.subtitle);
        var button = escapeHtml(banner.button_label);
        var link = banner.link_url ? escapeHtml(banner.link_url) : "#";
        var showText = banner.show_text !== false;
        var text = /^#[0-9a-f]{6}$/i.test(String(banner.text_color || "")) ? banner.text_color : "#ffffff";
        var overlay = normalizeOpacity(banner.overlay_opacity);
        return '<a class="adara-slide" href="' + link + '" style="--adara-text:' + text + ';--adara-overlay:' + overlay + '">' +
          '<img src="' + image + '" alt="' + title + '" loading="eager">' +
          (showText ? '<span class="adara-overlay"></span><span class="adara-copy"><h2>' + title + '</h2>' +
          (subtitle ? '<p>' + subtitle + '</p>' : '') +
          (button ? '<span class="adara-button">' + button + '</span>' : '') +
          '</span>' : '') +
          '</a>';
      }).join(""),
      '</div>',
      banners.length > 1 ? '<div class="adara-dots">' + banners.map(function (_, index) {
        return '<button class="adara-dot' + (index === 0 ? ' active' : '') + '" type="button" aria-label="Banner ' + (index + 1) + '"></button>';
      }).join("") + '</div>' : ''
    ].join("");

    if (existingCarousel && existingCarousel.parentNode) {
      existingCarousel.parentNode.replaceChild(root, existingCarousel);
    } else {
      var target = document.querySelector(".js-home-sections-container") || document.querySelector("main") || document.querySelector(".js-home-main") || document.body;
      target.insertBefore(root, target.firstChild);
    }

    function offsetMobileHeader() {
      if (!window.matchMedia || !window.matchMedia("(max-width: 720px)").matches) {
        root.style.marginTop = "";
        return;
      }
      var header = document.querySelector(".js-head-main, .head-main, header");
      if (!header || !window.getComputedStyle) return;
      var position = window.getComputedStyle(header).position;
      if (position !== "fixed" && position !== "sticky") return;
      root.style.marginTop = "";
      var headerBottom = Math.max(0, Math.round(header.getBoundingClientRect().bottom));
      var rootTop = Math.round(root.getBoundingClientRect().top);
      var offset = Math.max(0, headerBottom - rootTop);
      if (offset > 0) root.style.marginTop = offset + "px";
    }
    offsetMobileHeader();
    window.addEventListener("load", offsetMobileHeader);
    window.addEventListener("resize", offsetMobileHeader);
    window.setTimeout(offsetMobileHeader, 600);
    window.setTimeout(offsetMobileHeader, 1800);

    var index = 0;
    var track = root.querySelector(".adara-track");
    var dots = Array.prototype.slice.call(root.querySelectorAll(".adara-dot"));
    function go(next) {
      index = (next + banners.length) % banners.length;
      track.style.transform = "translateX(" + (-index * 100) + "%)";
      dots.forEach(function (dot, dotIndex) { dot.classList.toggle("active", dotIndex === index); });
    }
    dots.forEach(function (dot, dotIndex) { dot.addEventListener("click", function () { go(dotIndex); }); });
    if (banners.length > 1) window.setInterval(function () { go(index + 1); }, 6500);
  }

  fetch(origin + "/api/tiendanube/web-banners/public", { cache: "no-store" })
    .then(function (response) { return response.json(); })
    .then(function (data) { render(data.banners || []); })
    .catch(function () {});
})();
`;

export async function GET() {
  return new NextResponse(script.trim(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
