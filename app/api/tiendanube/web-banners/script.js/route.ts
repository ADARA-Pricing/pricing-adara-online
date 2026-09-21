import { NextResponse } from "next/server";

const script = `
(function () {
  var scriptEl = document.currentScript;
  var origin = scriptEl && scriptEl.getAttribute("data-adara-origin") || "https://pricing-adara-online.vercel.app";
  var isHome = location.pathname === "/" || location.pathname === "" || /^\\/[a-z]{2}(-[A-Z]{2})?\\/?$/.test(location.pathname);
  if (!isHome || document.getElementById("adara-campaign-carousel")) return;
  var prehideCarousel = document.querySelector(".template-home .adara-main-carousel, .adara-main-carousel, [data-adara-carousel]");
  if (prehideCarousel) prehideCarousel.style.setProperty("display", "none", "important");
  var prehidePromo = document.querySelector(".template-home .adara-hero-banners, .adara-hero-banners, [data-adara-after-institutional-carousel], .template-home .adara-promo-banners, .adara-promo-banners");
  if (prehidePromo) prehidePromo.style.setProperty("display", "none", "important");

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

  function normalizeTextWidth(value, fallback, min, max) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function bannerImage(banner) {
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches && banner.mobile_image_url) {
      return banner.mobile_image_url;
    }
    return banner.image_url;
  }

  function renderMain(banners) {
    if (!Array.isArray(banners) || !banners.length) return;
    var existingCarousel = prehideCarousel || document.querySelector(".template-home .adara-main-carousel, .adara-main-carousel, [data-adara-carousel]");
    var root = document.createElement("section");
    root.id = "adara-campaign-carousel";
    root.className = "adara-campaign-carousel";
    root.innerHTML = [
      '<style>',
      '#adara-campaign-carousel{position:relative;width:100%;overflow:hidden;background:#111;margin:0 0 24px;isolation:isolate}',
      '#adara-campaign-carousel .adara-track{display:flex;transition:transform .45s ease;will-change:transform;touch-action:pan-y}',
      '#adara-campaign-carousel .adara-slide{min-width:100%;position:relative;display:block;color:var(--adara-text,#fff);text-decoration:none}',
      '#adara-campaign-carousel .adara-slide img{display:block!important;width:100%!important;height:auto!important;max-height:none!important;object-fit:contain!important;object-position:center center!important;background:#111}',
      '#adara-campaign-carousel .adara-overlay{position:absolute;inset:0;background:#000;opacity:var(--adara-overlay,.28);pointer-events:none}',
      '#adara-campaign-carousel .adara-copy{position:absolute;inset:auto auto 10% 6%;width:min(920px,var(--adara-copy-width,46vw));max-width:88vw;z-index:2;color:var(--adara-text,#fff);text-shadow:0 2px 14px rgba(0,0,0,.35)}',
      '#adara-campaign-carousel .adara-copy h2{margin:0 0 8px;font-size:clamp(28px,4vw,56px);line-height:1.02;font-weight:800;letter-spacing:0}',
      '#adara-campaign-carousel .adara-copy p{margin:0 0 18px;font-size:clamp(15px,1.6vw,20px);line-height:1.35}',
      '#adara-campaign-carousel .adara-button{display:inline-flex;align-items:center;min-height:42px;padding:0 18px;border-radius:6px;background:#fff;color:#111;font-weight:700;text-shadow:none}',
      '#adara-campaign-carousel .adara-dots{position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:8px;z-index:3}',
      '#adara-campaign-carousel .adara-dot{width:9px;height:9px;border:0;border-radius:999px;background:rgba(255,255,255,.55);padding:0;cursor:pointer}',
      '#adara-campaign-carousel .adara-dot.active{background:#fff}',
      '@media(max-width:720px){#adara-campaign-carousel{margin-bottom:16px}#adara-campaign-carousel .adara-copy{left:18px;right:18px;bottom:24px;width:var(--adara-copy-width-mobile,86vw);max-width:calc(100vw - 36px)}}',
      '</style>',
      '<div class="adara-track">',
      banners.map(function (banner) {
        var image = escapeHtml(bannerImage(banner));
        var title = escapeHtml(banner.title);
        var subtitle = escapeHtml(banner.subtitle);
        var button = escapeHtml(banner.button_label);
        var link = banner.link_url ? escapeHtml(banner.link_url) : "#";
        var showText = banner.show_text !== false;
        var textWidth = normalizeTextWidth(banner.text_width_desktop, 46, 24, 70);
        var mobileTextWidth = normalizeTextWidth(banner.text_width_mobile, 86, 55, 100);
        var text = /^#[0-9a-f]{6}$/i.test(String(banner.text_color || "")) ? banner.text_color : "#ffffff";
        var overlay = normalizeOpacity(banner.overlay_opacity);
        return '<a class="adara-slide" href="' + link + '" style="--adara-text:' + text + ';--adara-overlay:' + overlay + ';--adara-copy-width:' + textWidth + 'vw;--adara-copy-width-mobile:' + mobileTextWidth + 'vw">' +
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

    function placeAfter(anchor, node) {
      if (!anchor || !node || !anchor.parentNode) return anchor;
      if (anchor.nextSibling !== node) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      return node;
    }

    function enforceSectionOrder() {
      var anchor = root;
      anchor = placeAfter(anchor, document.querySelector(".template-home .section-categories-home"));
      anchor = placeAfter(anchor, document.getElementById("adara-featured-product-dynamic"));
      anchor = placeAfter(anchor, document.querySelector("[data-adara-bestsellers]"));
      anchor = placeAfter(anchor, document.querySelector("[data-adara-notebooks]"));
      placeAfter(anchor, document.querySelector("[data-adara-tablets]"));
    }
    enforceSectionOrder();
    window.addEventListener("load", enforceSectionOrder);
    window.setTimeout(enforceSectionOrder, 500);
    window.setTimeout(enforceSectionOrder, 1500);
    window.setTimeout(enforceSectionOrder, 3500);
    if (window.MutationObserver && root.parentNode) {
      new MutationObserver(function () { window.setTimeout(enforceSectionOrder, 80); }).observe(root.parentNode, { childList: true });
    }

    function offsetMobileHeader() {
      if (!window.matchMedia || !window.matchMedia("(max-width: 720px)").matches) {
        root.style.marginTop = "";
        return;
      }
      if ((window.scrollY || window.pageYOffset || 0) > 20) return;
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
    window.setTimeout(offsetMobileHeader, 600);
    window.setTimeout(offsetMobileHeader, 1800);

    var index = 0;
    var track = root.querySelector(".adara-track");
    var dots = Array.prototype.slice.call(root.querySelectorAll(".adara-dot"));
    var touchStartX = 0;
    var touchStartY = 0;
    var touchDeltaX = 0;
    var touchDeltaY = 0;
    var swiped = false;
    function go(next) {
      index = (next + banners.length) % banners.length;
      track.style.transform = "translateX(" + (-index * 100) + "%)";
      dots.forEach(function (dot, dotIndex) { dot.classList.toggle("active", dotIndex === index); });
    }
    dots.forEach(function (dot, dotIndex) { dot.addEventListener("click", function () { go(dotIndex); }); });
    if (banners.length > 1 && window.TouchEvent) {
      track.addEventListener("touchstart", function (event) {
        if (!event.touches || !event.touches.length) return;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
        touchDeltaX = 0;
        touchDeltaY = 0;
        swiped = false;
      }, { passive: true });
      track.addEventListener("touchmove", function (event) {
        if (!event.touches || !event.touches.length) return;
        touchDeltaX = event.touches[0].clientX - touchStartX;
        touchDeltaY = event.touches[0].clientY - touchStartY;
      }, { passive: true });
      track.addEventListener("touchend", function () {
        if (Math.abs(touchDeltaX) < 45 || Math.abs(touchDeltaX) < Math.abs(touchDeltaY) * 1.25) return;
        swiped = true;
        go(index + (touchDeltaX < 0 ? 1 : -1));
        window.setTimeout(function () { swiped = false; }, 250);
      }, { passive: true });
      root.addEventListener("click", function (event) {
        if (!swiped) return;
        event.preventDefault();
        event.stopPropagation();
      }, true);
    }
    if (banners.length > 1) window.setInterval(function () { go(index + 1); }, 6500);
  }

  function renderPromo(banners) {
    if (!Array.isArray(banners) || !banners.length) return;
    var existingDynamic = document.getElementById("adara-promo-strip-dynamic");
    if (existingDynamic && existingDynamic.parentNode) existingDynamic.parentNode.removeChild(existingDynamic);
    var existingPromo = document.querySelector(".template-home .adara-hero-banners, .adara-hero-banners, [data-adara-after-institutional-carousel], .template-home .adara-promo-banners, .adara-promo-banners");
    var root = document.createElement("section");
    root.id = "adara-promo-strip-dynamic";
    root.className = "adara-promo-banners adara-promo-strip-dynamic";
    root.innerHTML = [
      '<style>',
      '#adara-promo-strip-dynamic{width:100%!important;padding:30px 0 54px!important;background:#f5f6f8!important;overflow:hidden!important}',
      '#adara-promo-strip-dynamic .adara-promo-shell{width:min(1360px,calc(100vw - 64px))!important;margin:0 auto!important}',
      '#adara-promo-strip-dynamic .adara-promo-track{display:grid!important;grid-auto-flow:column!important;grid-auto-columns:100%!important;gap:18px!important;overflow-x:auto!important;overflow-y:hidden!important;scroll-snap-type:x mandatory!important;scroll-behavior:smooth!important;-webkit-overflow-scrolling:touch!important;scrollbar-width:none!important;padding-bottom:4px!important}',
      '#adara-promo-strip-dynamic .adara-promo-track::-webkit-scrollbar{display:none!important}',
      '#adara-promo-strip-dynamic .adara-promo-card{position:relative!important;display:block!important;width:100%!important;aspect-ratio:3/1!important;overflow:hidden!important;border-radius:8px!important;scroll-snap-align:center!important;background:#f3eee7!important;box-shadow:0 18px 44px rgba(15,23,42,.08)!important;text-decoration:none!important;color:var(--adara-text,#fff)!important}',
      '#adara-promo-strip-dynamic .adara-promo-card img{display:block!important;width:100%!important;height:100%!important;object-fit:contain!important;object-position:center center!important}',
      '#adara-promo-strip-dynamic .adara-promo-dots{display:flex!important;justify-content:center!important;gap:8px!important;margin-top:14px!important}',
      '#adara-promo-strip-dynamic .adara-promo-dot{width:9px!important;height:9px!important;border:0!important;border-radius:999px!important;background:rgba(15,23,42,.28)!important;padding:0!important;cursor:pointer!important}',
      '#adara-promo-strip-dynamic .adara-promo-dot.active{background:#111827!important}',
      '#adara-promo-strip-dynamic .adara-overlay{position:absolute;inset:0;background:#000;opacity:var(--adara-overlay,.18);pointer-events:none}',
      '#adara-promo-strip-dynamic .adara-copy{position:absolute;left:5%;bottom:12%;width:min(680px,var(--adara-copy-width,42vw));max-width:82%;z-index:2;color:var(--adara-text,#fff);text-shadow:0 2px 14px rgba(0,0,0,.35)}',
      '#adara-promo-strip-dynamic .adara-copy h2{margin:0 0 8px;font-size:clamp(26px,3.4vw,50px);line-height:1.04;font-weight:800;letter-spacing:0}',
      '#adara-promo-strip-dynamic .adara-copy p{margin:0 0 16px;font-size:clamp(14px,1.4vw,19px);line-height:1.35}',
      '#adara-promo-strip-dynamic .adara-button{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:6px;background:#fff;color:#111;font-weight:700;text-shadow:none}',
      '@media(max-width:720px){#adara-promo-strip-dynamic{padding:18px 0 28px!important}#adara-promo-strip-dynamic .adara-promo-shell{width:calc(100vw - 28px)!important}#adara-promo-strip-dynamic .adara-promo-card{aspect-ratio:1586/992!important}#adara-promo-strip-dynamic .adara-copy{left:18px;right:18px;bottom:24px;width:var(--adara-copy-width-mobile,86vw);max-width:calc(100% - 36px)}}',
      '</style>',
      '<div class="adara-promo-shell"><div class="adara-promo-track">',
      banners.map(function (banner) {
        var image = escapeHtml(bannerImage(banner));
        var title = escapeHtml(banner.title);
        var subtitle = "";
        var button = "";
        var link = banner.link_url ? escapeHtml(banner.link_url) : "#";
        var showText = false;
        var textWidth = normalizeTextWidth(banner.text_width_desktop, 46, 24, 70);
        var mobileTextWidth = normalizeTextWidth(banner.text_width_mobile, 86, 55, 100);
        var text = /^#[0-9a-f]{6}$/i.test(String(banner.text_color || "")) ? banner.text_color : "#ffffff";
        var overlay = normalizeOpacity(banner.overlay_opacity);
        return '<a class="adara-promo-card" href="' + link + '" style="--adara-text:' + text + ';--adara-overlay:' + overlay + ';--adara-copy-width:' + textWidth + 'vw;--adara-copy-width-mobile:' + mobileTextWidth + 'vw">' +
          '<img src="' + image + '" alt="' + title + '" loading="lazy">' +
          (showText ? '<span class="adara-overlay"></span><span class="adara-copy"><h2>' + title + '</h2>' +
          (subtitle ? '<p>' + subtitle + '</p>' : '') +
          (button ? '<span class="adara-button">' + button + '</span>' : '') +
          '</span>' : '') +
          '</a>';
      }).join(""),
      '</div>',
      banners.length > 1 ? '<div class="adara-promo-dots">' + banners.map(function (_, index) {
        return '<button class="adara-promo-dot' + (index === 0 ? ' active' : '') + '" type="button" aria-label="Banner secundario ' + (index + 1) + '"></button>';
      }).join("") + '</div>' : '',
      '</div>'
    ].join("");

    if (existingPromo && existingPromo.parentNode) {
      existingPromo.parentNode.replaceChild(root, existingPromo);
    } else {
      var anchor = document.querySelector(".template-home .section-institutional-home, .section-institutional-home");
      var target = document.querySelector(".js-home-sections-container") || document.querySelector("main") || document.body;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(root, anchor.nextSibling);
      else target.appendChild(root);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".template-home .adara-hero-banners, .adara-hero-banners, [data-adara-after-institutional-carousel], .template-home .adara-promo-banners, .adara-promo-banners"), function (node) {
      if (node !== root && node.id !== "adara-promo-strip-dynamic" && node.parentNode) node.parentNode.removeChild(node);
    });

    var index = 0;
    var track = root.querySelector(".adara-promo-track");
    var cards = Array.prototype.slice.call(root.querySelectorAll(".adara-promo-card"));
    var dots = Array.prototype.slice.call(root.querySelectorAll(".adara-promo-dot"));
    var scrollTimer = 0;
    function go(next) {
      if (!track || !cards.length) return;
      index = (next + cards.length) % cards.length;
      var left = cards[index] && typeof cards[index].offsetLeft === "number" ? cards[index].offsetLeft : index * track.clientWidth;
      if (track.scrollTo) track.scrollTo({ left: left, behavior: "smooth" });
      else track.scrollLeft = left;
      dots.forEach(function (dot, dotIndex) { dot.classList.toggle("active", dotIndex === index); });
    }
    function syncFromScroll() {
      if (!track || !cards.length) return;
      var nearest = 0;
      var distance = Infinity;
      cards.forEach(function (card, cardIndex) {
        var currentDistance = Math.abs(card.offsetLeft - track.scrollLeft);
        if (currentDistance < distance) {
          distance = currentDistance;
          nearest = cardIndex;
        }
      });
      index = nearest;
      dots.forEach(function (dot, dotIndex) { dot.classList.toggle("active", dotIndex === index); });
    }
    dots.forEach(function (dot, dotIndex) { dot.addEventListener("click", function () { go(dotIndex); }); });
    if (track && banners.length > 1) {
      track.addEventListener("scroll", function () {
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(syncFromScroll, 120);
      }, { passive: true });
      window.setInterval(function () { go(index + 1); }, 6500);
    }
  }

  function renderFeatured(banners) {
    if (!Array.isArray(banners) || !banners.length) return;
    var banner = banners[0];
    var existingDynamic = document.getElementById("adara-featured-product-dynamic");
    if (existingDynamic && existingDynamic.parentNode) existingDynamic.parentNode.removeChild(existingDynamic);
    var root = document.createElement("section");
    root.id = "adara-featured-product-dynamic";
    root.className = "adara-featured-product-dynamic";
    var image = escapeHtml(bannerImage(banner));
    var title = escapeHtml(banner.title);
    var subtitle = escapeHtml(banner.subtitle);
    var button = escapeHtml(banner.button_label);
    var link = banner.link_url ? escapeHtml(banner.link_url) : "#";
    var showText = banner.show_text !== false;
    var textWidth = normalizeTextWidth(banner.text_width_desktop, 42, 24, 70);
    var mobileTextWidth = normalizeTextWidth(banner.text_width_mobile, 86, 55, 100);
    var text = /^#[0-9a-f]{6}$/i.test(String(banner.text_color || "")) ? banner.text_color : "#ffffff";
    var overlay = normalizeOpacity(banner.overlay_opacity);
    root.innerHTML = [
      '<style>',
      '#adara-featured-product-dynamic{width:100%!important;padding:22px 0 44px!important;background:#fff!important;overflow:hidden!important}',
      '#adara-featured-product-dynamic .adara-featured-shell{width:min(1360px,calc(100vw - 64px))!important;margin:0 auto!important}',
      '#adara-featured-product-dynamic .adara-featured-card{position:relative!important;display:block!important;width:100%!important;aspect-ratio:1440/520!important;overflow:hidden!important;border-radius:8px!important;background:#111827!important;text-decoration:none!important;color:var(--adara-text,#fff)!important;box-shadow:0 18px 44px rgba(15,23,42,.08)!important}',
      '#adara-featured-product-dynamic .adara-featured-card img{display:block!important;width:100%!important;height:100%!important;object-fit:contain!important;object-position:center center!important;background:#111827!important}',
      '#adara-featured-product-dynamic .adara-overlay{position:absolute;inset:0;background:#000;opacity:var(--adara-overlay,.24);pointer-events:none}',
      '#adara-featured-product-dynamic .adara-copy{position:absolute;left:5%;bottom:12%;width:min(680px,var(--adara-copy-width,42vw));max-width:82%;z-index:2;color:var(--adara-text,#fff);text-shadow:0 2px 14px rgba(0,0,0,.35)}',
      '#adara-featured-product-dynamic .adara-copy h2{margin:0 0 8px;font-size:clamp(28px,3.6vw,52px);line-height:1.04;font-weight:800;letter-spacing:0}',
      '#adara-featured-product-dynamic .adara-copy p{margin:0 0 16px;font-size:clamp(14px,1.45vw,19px);line-height:1.35}',
      '#adara-featured-product-dynamic .adara-button{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:6px;background:#fff;color:#111;font-weight:700;text-shadow:none}',
      '@media(max-width:720px){#adara-featured-product-dynamic{padding:16px 0 30px!important}#adara-featured-product-dynamic .adara-featured-shell{width:calc(100vw - 28px)!important}#adara-featured-product-dynamic .adara-featured-card{aspect-ratio:820/1100!important}#adara-featured-product-dynamic .adara-featured-card img{object-fit:cover!important}#adara-featured-product-dynamic .adara-copy{left:18px;right:18px;bottom:24px;width:var(--adara-copy-width-mobile,86vw);max-width:calc(100% - 36px)}}',
      '</style>',
      '<div class="adara-featured-shell"><a class="adara-featured-card" href="' + link + '" style="--adara-text:' + text + ';--adara-overlay:' + overlay + ';--adara-copy-width:' + textWidth + 'vw;--adara-copy-width-mobile:' + mobileTextWidth + 'vw">',
      '<img src="' + image + '" alt="' + title + '" loading="lazy">',
      (showText ? '<span class="adara-overlay"></span><span class="adara-copy"><h2>' + title + '</h2>' +
      (subtitle ? '<p>' + subtitle + '</p>' : '') +
      (button ? '<span class="adara-button">' + button + '</span>' : '') +
      '</span>' : ''),
      '</a></div>'
    ].join("");

    var categories = document.querySelector(".template-home .section-categories-home, .section-categories-home");
    var mainCarousel = document.getElementById("adara-campaign-carousel");
    var target = document.querySelector(".js-home-sections-container") || document.querySelector("main") || document.body;
    if (categories && categories.parentNode) categories.parentNode.insertBefore(root, categories.nextSibling);
    else if (mainCarousel && mainCarousel.parentNode) mainCarousel.parentNode.insertBefore(root, mainCarousel.nextSibling);
    else target.insertBefore(root, target.firstChild);
  }

  fetch(origin + "/api/tiendanube/web-banners/public", { cache: "no-store" })
    .then(function (response) { return response.json(); })
    .then(function (data) {
      var banners = data.banners || [];
      renderMain(banners.filter(function (banner) { return banner.placement !== "promo_strip" && banner.placement !== "featured_product"; }));
      renderPromo(banners.filter(function (banner) { return banner.placement === "promo_strip"; }));
      renderFeatured(banners.filter(function (banner) { return banner.placement === "featured_product"; }));
    })
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
