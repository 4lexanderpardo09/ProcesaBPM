-- «Días fuera», like the help desk: a field listing the days of a trip between two date fields, where the person unticks
-- the days they were not away (the value keeps those days). The meal calculator pays nothing on them.
ALTER TYPE field_type ADD VALUE 'TRIP_DAYS' AFTER 'DAYS';
