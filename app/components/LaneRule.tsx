type LaneRuleProps = {
  variant: "dots" | "arrows";
  className?: string;
};

export default function LaneRule({ variant, className = "" }: LaneRuleProps) {
  return (
    <div
      className={`lane-rule lane-rule-${variant}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: 7 }, (_, index) => (
        <span key={`${variant}-${index}`} className="lane-rule-mark" />
      ))}
    </div>
  );
}
