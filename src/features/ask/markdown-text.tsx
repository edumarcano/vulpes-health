import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="chat-markdown"
      smooth={false}
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3>{children}</h3>,
        h2: ({ children }) => <h3>{children}</h3>,
        a: ({ href, children }) =>
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
        img: ({ alt }) => <span>{alt || 'Image omitted'}</span>,
        table: ({ children }) => (
          <div
            className="markdown-table-scroll"
            role="region"
            aria-label="Response table"
            tabIndex={0}
          >
            <table>{children}</table>
          </div>
        ),
      }}
    />
  );
}
