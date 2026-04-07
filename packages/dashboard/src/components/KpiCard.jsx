export default function KpiCard({ title, value, sub }) {
  return (
    <div className="kpiCard">
      <h2>{title}</h2>
      <div className="kpiValue">{value}</div>
      {sub && <div className="kpiSub">{sub}</div>}
    </div>
  );
}
