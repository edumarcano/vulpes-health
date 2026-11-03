import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface ConversationItem {
  id: string;
  title: string;
  createdAt?: string;
  archived?: boolean;
}

export interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  items: ConversationItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  archived: boolean;
  onArchivedChange: (archived: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
  hasNextPage?: boolean;
  onFetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  isError?: boolean;
  onRefetch?: () => void;
}

export function HistoryDrawer({
  open,
  onOpenChange,
  onCloseAutoFocus,
  items,
  currentId,
  onSelect,
  archived,
  onArchivedChange,
  onArchive,
  onDelete,
  isPending,
  hasNextPage,
  onFetchNextPage,
  isFetchingNextPage,
  isError,
  onRefetch,
}: HistoryDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        aria-label="Conversation history"
        className="w-full sm:max-w-md flex flex-col p-6 overflow-hidden bg-card border-r border-border"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader className="mb-2">
          <SheetTitle>Conversation history</SheetTitle>
          <SheetDescription>
            Switch threads, browse archives, or manage storage
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between py-2 border-b border-border">
          <label className="checkbox-label text-sm flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => onArchivedChange(e.target.checked)}
            />
            Archived
          </label>
          {currentId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onArchive(currentId)}
              disabled={isPending || archived}
            >
              Archive conversation
            </Button>
          )}
        </div>

        {currentId && (
          <div className="py-2 border-b border-border text-xs">
            <details>
              <summary className="cursor-pointer font-medium text-destructive">
                Delete conversation
              </summary>
              <p className="my-2 text-muted-foreground">
                Delete this conversation, its messages, and private traces?
                Accounting records may remain.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={() => onDelete(currentId)}
                disabled={isPending}
              >
                Confirm delete conversation
              </Button>
            </details>
          </div>
        )}

        <div className="history-drawer-list flex-1 overflow-y-auto space-y-2 py-3">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground italic py-4">
              No {archived ? 'archived' : 'active'} conversations.
            </p>
          )}
          {items.map((item) => {
            const isActive = item.id === currentId;
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${
                  isActive
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <button
                  type="button"
                  className="flex-1 text-left font-medium text-sm truncate cursor-pointer hover:underline"
                  onClick={() => onSelect(item.id)}
                >
                  {item.title || 'Untitled conversation'}
                </button>
                {isActive && <Badge variant="secondary">Active</Badge>}
              </div>
            );
          })}
          {hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={onFetchNextPage}
              disabled={isFetchingNextPage}
            >
              Load more conversations
            </Button>
          )}
        </div>

        {isError && (
          <div role="alert" className="py-2 text-xs text-destructive space-y-1">
            <p>Conversations could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={onRefetch}>
              Reload history
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
