import { useEffect, useState } from "react";
import { financeApi, type FxQuote } from "../../lib/finance";

// One in-flight/settled lookup per currency+day+base for the whole session,
// so many grid rows in the same currency share a single request. The base
// is part of the key because each account has its own base currency.
const cache = new Map<string, Promise<FxQuote | null>>();

export function lookupFx(currency: string, date: string, base: string): Promise<FxQuote | null> {
  const key = `${currency}|${date}|${base}`;
  let p = cache.get(key);
  if (!p) {
    p = financeApi.fx(currency, date, base).catch(() => null);
    cache.set(key, p);
    // A failure shouldn't stick for the whole session — let a later try refetch.
    void p.then((q) => {
      if (!q) cache.delete(key);
    });
  }
  return p;
}

export interface FxState {
  quote: FxQuote | null;
  loading: boolean;
  unavailable: boolean;
}

export function useFx(currency: string, date: string, base: string): FxState {
  const [state, setState] = useState<FxState>({ quote: null, loading: false, unavailable: false });

  useEffect(() => {
    if (!currency || currency === base || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setState({ quote: null, loading: false, unavailable: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void lookupFx(currency, date, base).then((quote) => {
      if (!cancelled) setState({ quote, loading: false, unavailable: quote === null });
    });
    return () => {
      cancelled = true;
    };
  }, [currency, date, base]);

  return state;
}
