export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.76 11.19A7 7 0 1 1 12.22 6.11" stroke="currentColor" strokeWidth="4.5" />
      <rect x="17" y="2" width="5" height="5" fill="#296ff0" />
    </svg>
  );
}
