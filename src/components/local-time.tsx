"use client";

import { useEffect, useState } from "react";
import { formatAge, formatLocal, formatUtc } from "@/lib/format";

type Props = { iso: string; showAge?: boolean };

/**
 * Renders a server timestamp in the viewer's local time with timezone context.
 * The server render uses UTC so hydration is deterministic; the exact UTC value
 * stays available via the title attribute and machine-readable dateTime.
 */
export function LocalTime({ iso, showAge = false }: Props) {
  const [local, setLocal] = useState<{ text: string; age: string } | null>(null);

  useEffect(() => {
    setLocal({ text: formatLocal(iso), age: formatAge(iso, Date.now()) });
  }, [iso]);

  const exact = `${formatUtc(iso)} (${iso})`;
  return (
    <span className="time">
      <time dateTime={iso} title={exact}>
        {local?.text ?? formatUtc(iso)}
      </time>
      {showAge ? <span className="muted"> · {local?.age ?? ""}</span> : null}
    </span>
  );
}
