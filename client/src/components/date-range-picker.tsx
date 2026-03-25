import { useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  className?: string;
  triggerClassName?: string;
}

export function DateRangePicker({ dateRange, onDateRangeChange, className, triggerClassName }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 text-xs gap-1.5 justify-start font-normal", triggerClassName)}
          data-testid="button-custom-date-range"
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {dateRange?.from ? (
            dateRange.to ? (
              <>
                {format(dateRange.from, "M/d/yy")} - {format(dateRange.to, "M/d/yy")}
              </>
            ) : (
              format(dateRange.from, "M/d/yy")
            )
          ) : (
            "Pick dates"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={dateRange?.from}
          selected={dateRange}
          onSelect={(range) => {
            onDateRangeChange(range);
            if (range?.from && range?.to) {
              setOpen(false);
            }
          }}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
          data-testid="calendar-date-range"
        />
      </PopoverContent>
    </Popover>
  );
}
