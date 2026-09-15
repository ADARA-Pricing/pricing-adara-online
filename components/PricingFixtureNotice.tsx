"use client";
import { useEffect, useState } from "react";
export function PricingFixtureNotice() {
  const [metrics, setMetrics] = useState({ requests: 0, bytes: 0 });
  const [timings, setTimings] = useState("");
  useEffect(() => {
    const listener = (event: Event) => setMetrics((event as CustomEvent).detail);
    window.addEventListener('pricing-fixture-metrics', listener);
    const update = () => setTimings(performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('pricing:')).slice(-4).map(entry => `${entry.name}: ${Math.round(entry.duration)} ms`).join(' · '));
    update();
    const observer = new PerformanceObserver(update);
    observer.observe({ entryTypes: ['measure'] });
    return () => { window.removeEventListener('pricing-fixture-metrics', listener); observer.disconnect(); };
  }, []);
  if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_PRICING_FIXTURES !== '1') return null;
  return <aside className="pricing-fixture-notice">DATOS SIMULADOS · APIs externas bloqueadas · {metrics.requests} lecturas · {metrics.bytes.toLocaleString('es-AR')} bytes de fixture · {timings}</aside>;
}
