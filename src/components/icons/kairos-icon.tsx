export type KairosIconProps = {
    className?: string
}

export function KairosIcon({ className }: KairosIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="84"
            height="84"
            viewBox="0 0 84 84"
            fill="none"
            className={className}
        >
            {/* Rounded square */}
            <rect
                x="8"
                y="8"
                width="50"
                height="50"
                rx="11"
                fill="currentColor"
                className="text-primary-950"
            />
            {/* Circle centred at the square's bottom-right corner */}
            <circle
                cx="58"
                cy="58"
                r="24"
                fill="currentColor"
                className="text-primary-500"
            />
        </svg>
    )
}
