import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/* -------------------------------- Button -------------------------------- */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-600 shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-border bg-transparent hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        success: "bg-success text-success-foreground hover:bg-success/90",
      },
      // Under a coarse pointer (touch) every size reaches the 44px minimum target.
      size: {
        sm: "h-8 px-3 [@media(pointer:coarse)]:h-11",
        md: "h-10 px-4 [@media(pointer:coarse)]:h-11",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

/* --------------------------------- Card --------------------------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-card", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

/* -------------------------------- Inputs -------------------------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/* -------------------------------- Badge --------------------------------- */
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------- Dialog -------------------------------- */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-6 shadow-xl animate-fade-in",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:right-1.5 [@media(pointer:coarse)]:top-1.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <X size={16} />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

/* ------------------------------- Popover -------------------------------- */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg animate-fade-in",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ------------------------------- Tooltip -------------------------------- */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow animate-fade-in"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------ Page layout ------------------------------ */

const PAGE_WIDTH = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
} as const;

/**
 * The scrolling body of an ordinary page: the scroll container plus the centred,
 * padded column every page shares. Pages with their own toolbar (Bible, Commentary,
 * Companion) don't use it.
 */
export function PageBody({
  width = "sm",
  className,
  outerClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  width?: keyof typeof PAGE_WIDTH;
  outerClassName?: string;
}) {
  return (
    <div className={cn("h-full overflow-y-auto", outerClassName)} {...props}>
      <div className={cn("mx-auto px-4 py-6 md:px-8 md:py-8", PAGE_WIDTH[width], className)}>{children}</div>
    </div>
  );
}

/**
 * A page's title row: the title (serif), an optional subtitle, and actions. The
 * title block takes the room it needs first; when the actions don't fit beside it
 * they drop below as a group instead of squeezing the title or wrapping their labels.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-start gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 flex-1 basis-[15rem]">
        <h1 className="flex items-center gap-2 text-balance font-serif text-2xl font-bold sm:text-3xl">
          {icon}
          {title}
        </h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:shrink-0 [&>*]:whitespace-nowrap">{actions}</div>
      )}
    </header>
  );
}

/* ------------------------------- ChipGroup ------------------------------- */

export interface ChipOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Accessible name when the visible label is shortened or hidden. */
  ariaLabel?: string;
  title?: string;
}

/**
 * Pick one of a few options: a row of chips (or a segmented control) with radio
 * semantics — Radix ToggleGroup, so it is one Tab stop and arrow keys move between
 * options. `allowDeselect` lets a second tap clear the choice (filters).
 */
export function ChipGroup<T extends string>({
  value,
  onValueChange,
  options,
  label,
  variant = "chip",
  allowDeselect,
  className,
}: {
  value: T | null;
  onValueChange: (v: T | null) => void;
  options: ChipOption<T>[];
  /** Names the group for screen readers. */
  label: string;
  variant?: "chip" | "segmented";
  allowDeselect?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value ?? ""}
      onValueChange={(v) => {
        if (v) onValueChange(v as T);
        else if (allowDeselect) onValueChange(null);
      }}
      aria-label={label}
      className={cn(
        variant === "chip"
          ? "flex flex-wrap items-center gap-1.5"
          : "inline-flex items-center rounded-lg border border-border bg-card/70 p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          title={o.title}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "chip"
              ? "min-h-8 rounded-full border px-3 py-1 text-sm data-[state=off]:border-border data-[state=off]:text-muted-foreground data-[state=off]:hover:bg-accent data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary-700 dark:data-[state=on]:text-primary-300 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5"
              : "min-h-8 rounded-md px-2.5 py-1.5 text-xs data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* --------------------------------- Tabs ---------------------------------- */

export interface TabOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * Segmented tabs over one panel (Radix Tabs: tablist/tab/tabpanel roles, arrow keys).
 * Only the active panel is rendered: pass its content as children.
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  tabs,
  label,
  className,
  listClassName,
  children,
}: {
  value: T;
  onValueChange: (v: T) => void;
  tabs: TabOption<T>[];
  label: string;
  className?: string;
  listClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} className={className}>
      <TabsPrimitive.List aria-label={label} className={cn("flex gap-1 rounded-lg bg-muted p-1", listClassName)}>
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground [@media(pointer:coarse)]:min-h-11"
          >
            {t.icon}
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children !== undefined && (
        <TabsPrimitive.Content value={value} className="focus-visible:outline-none">
          {children}
        </TabsPrimitive.Content>
      )}
    </TabsPrimitive.Root>
  );
}

/* -------------------------------- Switch --------------------------------- */

/**
 * An on/off setting: the label (and optional description) on the left, a Radix
 * switch on the right, linked so the whole row reads as one control. Without a
 * `label`, pass `aria-label` for a bare switch.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Extra controls shown between the label and the switch (e.g. a time). */
  children?: React.ReactNode;
  "aria-label"?: string;
}) {
  const id = React.useId();
  const control = (
    <SwitchPrimitive.Root
      id={`${id}-switch`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      className="peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2.5 [@media(pointer:coarse)]:after:content-['']"
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-md ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 dark:bg-foreground dark:data-[state=unchecked]:bg-muted-foreground" />
    </SwitchPrimitive.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <div className="min-w-0 flex-1">
        <label id={`${id}-label`} htmlFor={`${id}-switch`} className="text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      <div className="flex h-6 items-center">{control}</div>
    </div>
  );
}

/* ------------------------------ Field label ------------------------------ */

/** A visible label above a form control (A5: no placeholder-only inputs). */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
