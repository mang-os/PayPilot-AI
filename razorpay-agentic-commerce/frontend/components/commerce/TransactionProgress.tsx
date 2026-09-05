import { useEffect, useRef } from "react";
import { buyerProgress, type BuyerProgressInput } from "@/lib/transaction-progress";
import s from "./TransactionProgress.module.css";

export default function TransactionProgress(props: BuyerProgressInput) {
  const progress = buyerProgress(props);
  const rail = useRef<HTMLOListElement>(null);
  const current = progress.stages.findIndex((stage) => stage.state === "active" || stage.state === "failed");
  const focusIndex = current >= 0 ? current : Math.max(0, progress.stages.findLastIndex((stage) => stage.state === "completed"));

  useEffect(() => {
    const list = rail.current;
    const node = list?.children[focusIndex] as HTMLElement | undefined;
    if (!list || !node) return;
    const revealCurrent = () => {
      if (list.scrollWidth > list.clientWidth) {
        list.scrollLeft = Math.max(0, node.offsetLeft - list.clientWidth / 2 + node.offsetWidth / 2);
      }
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(list);
    return () => observer.disconnect();
  }, [focusIndex]);

  return (
    <section className={s.progress} aria-label="Transaction progress">
      <div className={s.heading}><span>Purchase progress</span><p role="status" data-state={progress.state}>{progress.detail}</p></div>
      <ol ref={rail} className={s.rail} tabIndex={0} aria-label="Seven purchase stages; scroll to see all stages">
        {progress.stages.map((stage, index) => (
          <li key={stage.id} className={s.stage} data-state={stage.state} aria-current={stage.state === "active" ? "step" : undefined}>
            <span className={s.node} aria-hidden="true">{stage.state === "completed" ? "✓" : stage.state === "failed" ? "!" : index + 1}</span>
            <span className={s.label}>{stage.label}</span>
            <span className={s.state}>{stage.caption || (stage.state === "completed" ? "Done" : stage.state === "failed" ? "Failed" : stage.state === "active" ? "In progress" : "Upcoming")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
