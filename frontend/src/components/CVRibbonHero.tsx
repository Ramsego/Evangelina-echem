const PATH = "M 82 242 C 188 240 298 241 358 229 C 428 215 449 153 470 100 C 489 52 522 44 548 70 C 574 96 582 139 610 178 C 648 231 704 246 812 244 C 700 260 612 268 550 282 C 494 294 466 314 448 358 C 432 408 404 431 372 390 C 344 354 330 312 286 296 C 228 276 150 300 82 306";

export default function CVRibbonHero() {
  return (
    <svg
      viewBox="0 0 880 430"
      aria-hidden="true"
      className="w-full h-auto max-w-3xl mx-auto block"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient
          id="edgeGradient"
          gradientUnits="userSpaceOnUse"
          x1="72" y1="238" x2="830" y2="104"
        >
          <stop offset="0%"   stopColor="var(--cvh-edge-a)" />
          <stop offset="44%"  stopColor="var(--cvh-edge-b)" />
          <stop offset="100%" stopColor="var(--cvh-edge-c)" />
        </linearGradient>
        <filter id="pulseBlur" x="-5%" y="-50%" width="110%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* shadow */}
      <path d={PATH} fill="none" stroke="rgba(0,0,0,0.42)" strokeWidth={24}
            style={{ transform: "translate(0, 16px)" }} opacity={0.48} />
      {/* ghost */}
      <path d={PATH} fill="none" stroke="var(--cvh-ghost)" strokeWidth={20} />
      {/* glass — draws in */}
      <path d={PATH} fill="none" stroke="var(--cvh-glass)" strokeWidth={6.6}
            strokeDasharray={980} pathLength={980} className="cv-draw" />
      {/* edge gradient — draws in */}
      <path d={PATH} fill="none" stroke="url(#edgeGradient)" strokeWidth={2.6}
            strokeDasharray={980} pathLength={980} className="cv-draw" />
      {/* pulse — moving scan dot */}
      <path d={PATH} fill="none" stroke="var(--cvh-pulse)" strokeWidth={3.6}
            strokeDasharray="130 850" pathLength={980}
            className="cv-pulse" filter="url(#pulseBlur)" />
    </svg>
  );
}
