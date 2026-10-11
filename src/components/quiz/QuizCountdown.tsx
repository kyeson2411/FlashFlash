"use client";

import { useEffect, useState } from "react";
import { quizCountdown, type QuizWindow } from "@/lib/quiz";

/** Updates every 30 seconds. Starts from the server's time so the first render matches. */
export function QuizCountdown({
  dueAt,
  opensAt,
  window: access,
  serverNow,
}: {
  dueAt: string | null;
  opensAt: string | null;
  window: QuizWindow;
  serverNow: string;
}) {
  const [now, setNow] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return <>{quizCountdown({ dueAt, opensAt }, access, new Date(now))}</>;
}
