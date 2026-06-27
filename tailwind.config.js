/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6366F1',
          50: 'oklch(97% 0.01 280)',
          100: 'oklch(93% 0.03 280)',
          200: 'oklch(85% 0.06 280)',
          300: 'oklch(75% 0.10 280)',
          400: 'oklch(68% 0.14 280)',
          500: 'oklch(60% 0.18 280)',
          600: 'oklch(50% 0.16 280)',
          700: 'oklch(40% 0.14 280)',
          800: 'oklch(30% 0.10 280)',
          900: 'oklch(20% 0.06 280)',
        },
        'primary-light': '#818CF8',
        'primary-dark': '#4F46E5',
        brand: {
          50: 'oklch(97.5% 0.005 260)',
          100: 'oklch(90% 0.005 260)',
          200: 'oklch(65% 0.005 260)',
          300: 'oklch(45% 0.01 260)',
          400: 'oklch(20% 0.01 260)',
        },
        income: '#10B981',
        'income-light': '#6EE7B7',
        'income-dark': '#059669',
        expense: '#EF4444',
        'expense-light': '#F87171',
        'expense-dark': '#DC2626',
        profit: '#3B82F6',
        'profit-light': '#60A5FA',
        'profit-dark': '#2563EB',
        cash: '#8B5CF6',
        'cash-light': '#A78BFA',
        'cash-dark': '#7C3AED',
        neutral: {
          page: 'oklch(97.5% 0.005 260)',
          card: '#FFFFFF',
          primary: 'oklch(20% 0.01 260)',
          secondary: 'oklch(45% 0.01 260)',
          tertiary: 'oklch(65% 0.005 260)',
          border: 'oklch(88% 0.005 260)',
        },
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
      },
      fontFamily: {
        heading: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
