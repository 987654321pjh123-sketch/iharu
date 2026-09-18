import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiErrorSchema } from '../../shared/contracts';
export function useApi<T>(path: string, schema: z.ZodType<T>) {
  const [state, setState] = useState<{ data?:T; error?:string; loading:boolean }>({ loading:true });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading:true });
    (async () => {
      try {
        const response = await fetch(path, { signal:controller.signal, credentials:'same-origin', cache:'no-store' });
        const json: unknown = await response.json();
        if (!response.ok) {
          const parsed = apiErrorSchema.safeParse(json);
          throw new Error(parsed.success ? parsed.data.error.message : '잠시 후 다시 시도해 주세요.');
        }
        const data = schema.parse(json);
        if (!controller.signal.aborted) setState({ data, loading:false });
      } catch (error) {
        if (!controller.signal.aborted) setState({ loading:false, error:error instanceof Error ? error.message : '연결을 확인해 주세요.' });
      }
    })();
    return () => controller.abort();
  }, [path, schema, revision]);
  return { ...state, retry };
}
