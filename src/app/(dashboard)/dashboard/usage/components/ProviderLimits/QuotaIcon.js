// Local outline icons keep quota controls independent of icon-font loading.
const paths = {
  refresh: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17",
  edit: "m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z",
  delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  schedule: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  bolt: "m13 2-9 12h7l-1 8 10-13h-7z",
  block: "m6 6 12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  check_circle: "m8 12 3 3 5-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  expand_more: "m6 9 6 6 6-6",
  apps: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  hourglass_empty: "M6 3h12M6 21h12M7 3v4l10 10v4M17 3v4L7 17v4",
};
export default function QuotaIcon({ name, className = "" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={paths[name]} /></svg>;
}
