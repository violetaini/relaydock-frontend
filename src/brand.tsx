interface BrandMarkProps {
  className?: string;
  size?: number;
}

export function BrandMark({ className = "", size = 20 }: BrandMarkProps) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <img src="/brand.png" alt="" width={size} height={size} />
    </span>
  );
}
