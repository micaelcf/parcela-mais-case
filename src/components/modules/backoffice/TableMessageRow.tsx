import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty";
import { TableCell, TableRow } from "#/components/ui/table";

/**
 * A table body's only row when there is nothing to list (or the list failed): icon, short title,
 * optional hint and action, across every column. Every backoffice table shows its empty state so.
 */
export function TableMessageRow({
  colSpan,
  icon,
  title,
  description,
  action,
}: {
  colSpan: number;
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0 whitespace-normal">
        <Empty className="gap-3 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="text-muted-foreground">
              {icon}
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          </EmptyHeader>
          {action ? <EmptyContent>{action}</EmptyContent> : null}
        </Empty>
      </TableCell>
    </TableRow>
  );
}
