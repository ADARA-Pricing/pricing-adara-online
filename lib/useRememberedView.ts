"use client";
import { useEffect, useRef } from "react";
const views = new Map<string, { values: unknown[]; scroll: number }>();
export function useRememberedView(client: any, module: string, values: unknown[], restore: (values: any[]) => void, ready: boolean) {
  const current = useRef(values);
  useEffect(() => { current.current = values; }, [values]);
  const key = useRef<string | null>(null);
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    let active = true;
    client.auth.getSession().then(({ data }: any) => {
      if (!active || !data.session?.user?.id) return;
      key.current = `${data.session.user.id}:${module}`;
      const prior = views.get(key.current);
      if (prior && !window.location.search) { restore(prior.values); pendingScroll.current = prior.scroll; }
    });
    const save = () => { if (key.current) views.set(key.current, { values: current.current, scroll: window.scrollY }); };
    const { data: auth } = client.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_OUT') { views.clear(); key.current = null; pendingScroll.current = null; }
    });
    window.addEventListener('scroll', save, { passive: true });
    return () => { save(); active = false; window.removeEventListener('scroll', save); auth.subscription.unsubscribe(); };
    // State is read through refs, restoration happens once per user/module mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, module]);
  useEffect(() => { if (ready && pendingScroll.current != null) { window.scrollTo(0, pendingScroll.current); pendingScroll.current = null; } }, [ready]);
}
