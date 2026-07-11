import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "@/db";
import { getAnyPlan } from "@/data/plans";
import { useUI } from "@/store/ui";

/**
 * Resolver for the reading-plan reminder's deep-link. A scheduled notification carries
 * a FIXED payload, but "today's reading" depends on progress at tap time — so the
 * notification links here (`/read-today`) and we compute the current plan day now and
 * drop straight into the on-rails guided reader for it.
 */
export function ReadTodayPage() {
  const navigate = useNavigate();
  const activePlanId = useUI((s) => s.activePlanId);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activePlanId) {
        navigate("/plans", { replace: true });
        return;
      }
      const plan = await getAnyPlan(activePlanId);
      const prog = await db.plans.get(activePlanId);
      if (!alive) return;
      if (!plan) {
        navigate("/plans", { replace: true });
        return;
      }
      const done = new Set(prog?.completedDays ?? []);
      let day = 0;
      while (day < plan.days.length && done.has(day)) day++;
      if (day >= plan.days.length) {
        navigate("/plans", { replace: true }); // plan finished — nothing due
        return;
      }
      navigate(`/guided/${activePlanId}/${day}`, { replace: true });
    })();
    return () => {
      alive = false;
    };
  }, [activePlanId, navigate]);

  return <div className="p-10 text-center text-muted-foreground">Opening today’s reading…</div>;
}
