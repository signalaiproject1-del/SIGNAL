import ReviewWorkspace from './workspace';
export const metadata = { title: 'Review workspace | SIGNAL', robots: { index: false, follow: false } };
export default function ReviewPage() {
  return <main><header><a className="wordmark" href="/">SIGNAL<span>●</span></a><a className="tag" href="/">← SOURCE LIBRARY</a></header>
    <section className="hero review-hero"><p className="eyebrow">PRIVATE EDITORIAL WORKSPACE</p><h1>Review the evidence.</h1><p className="intro">Prepare a policy record, cite its source and check it before publishing. Drafts stay private. No AI processing runs here.</p></section>
    <ReviewWorkspace />
    <footer><span>SIGNAL / Evidence before interpretation</span><a href="/">Public site ↗</a></footer></main>;
}
