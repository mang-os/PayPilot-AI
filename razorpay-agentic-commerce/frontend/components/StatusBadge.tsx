const STATUS_STYLES: Record<string, string> = {
  PASS: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  VALID: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  RESERVED: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  VERIFIED: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  COMPLETE: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  PAID: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  COMPLETED: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  CAPTURED: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",
  ACTIVE: "border-[#A6D7BA] bg-[#ECFDF3] text-[#087443]",

  REJECTED: "border-[#F4B8B3] bg-[#FEF3F2] text-[#B42318]",
  BLOCKED: "border-[#F4B8B3] bg-[#FEF3F2] text-[#B42318]",
  FAILED: "border-[#F4B8B3] bg-[#FEF3F2] text-[#B42318]",

  AWAITING: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  "AWAITING PAYMENT": "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  PROCESSING: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  "NOT INVOKED": "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]",
  "NOT RESERVED": "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]",
  CREATED: "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]",
  UPDATED: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  PENDING: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
};

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-[#667085]">{"\u2014"}</span>;
  const normalized = status.trim().toUpperCase();
  const style = STATUS_STYLES[normalized] ?? "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]";
  const displayStatus = normalized === "COMPLETED" ? "COMPLETE" : normalized;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] ${style}`}
    >
      {displayStatus}
    </span>
  );
}
