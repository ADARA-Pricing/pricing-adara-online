export default function Home() {
  return (
    <main className="container">
      <section className="card login">
        <div className="login-brand">
          <img src="/logo-adara.png" alt="ADARA Group" />
        </div>
        <h1>Pricing ADARA</h1>
        <p className="small">App interna de productos, costos y precios por canal.</p>
        <div style={{ marginTop: 20 }}>
          <a className="button" href="/login">Ingresar</a>
        </div>
      </section>
    </main>
  );
}
