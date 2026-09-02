const STATUS_STYLES: Record<string, string> = {
  // verified / success
  PAID: "bg-verified/10 text-verified border-verified/30",
  COMPLETED: "bg-verified/10 text-verified border-verified/30",
  CAPTURED: "bg-verified/10 text-verified border-verified/30",
  ACTIVE: "bg-verified/10 text-verified border-verified/30",
  // failure
  FAILED: "bg-alert/10 text-alert border-alert/30",
  REJECTED: "bg-alert/10 text-alert border-alert/30",
  // pending / in-flight
  CREATED: "bg-wire/10 text-wire border-wire/30",
  UPDATED: "bg-wire/10 text-wire border-wire/30",
  PENDING: "bg-wire/10 text-wire border-wire/30",
};

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-inkmuted">{"\u2014"}</span>;
  const style = STATUS_STYLES[status] ?? "bg-inkmuted/10 text-inkmuted border-inkmuted/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide ${style}`}
    >
      {status}
    </span>
  );
}
