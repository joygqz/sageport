use crate::error::{AppError, AppResult};

const MAX_LEN: usize = 256;

struct FieldSpec {
    name: &'static str,
    min: u32,
    max: u32,
}

const FIELDS: [FieldSpec; 5] = [
    FieldSpec {
        name: "minute",
        min: 0,
        max: 59,
    },
    FieldSpec {
        name: "hour",
        min: 0,
        max: 23,
    },
    FieldSpec {
        name: "day of month",
        min: 1,
        max: 31,
    },
    FieldSpec {
        name: "month",
        min: 1,
        max: 12,
    },
    FieldSpec {
        name: "day of week",
        min: 0,
        max: 7,
    },
];

/// Validate a 5-field cron expression (minute hour day-of-month month day-of-week)
/// and return it trimmed. This is the trust boundary for stored and synced schedules;
/// the frontend computes the actual next run times. Supports `*`, `*/step`, ranges
/// `a-b`, `a-b/step`, and comma lists of those.
pub fn validate_cron(expr: &str) -> AppResult<String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("cron schedule is empty".into()));
    }
    if trimmed.len() > MAX_LEN {
        return Err(AppError::Invalid("cron schedule is too long".into()));
    }
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(AppError::Invalid(
            "cron schedule must have 5 fields: minute hour day month weekday".into(),
        ));
    }
    for (field, spec) in fields.iter().zip(FIELDS.iter()) {
        validate_field(field, spec)?;
    }
    Ok(trimmed.to_string())
}

fn validate_field(field: &str, spec: &FieldSpec) -> AppResult<()> {
    if field.is_empty() {
        return Err(invalid(spec, field));
    }
    for part in field.split(',') {
        validate_part(part, spec)?;
    }
    Ok(())
}

fn validate_part(part: &str, spec: &FieldSpec) -> AppResult<()> {
    let (range, step) = match part.split_once('/') {
        Some((range, step)) => {
            let step: u32 = step.parse().map_err(|_| invalid(spec, part))?;
            if step == 0 {
                return Err(invalid(spec, part));
            }
            (range, Some(step))
        }
        None => (part, None),
    };

    if range == "*" {
        return Ok(());
    }

    match range.split_once('-') {
        Some((start, end)) => {
            let start = parse_bounded(start, spec, part)?;
            let end = parse_bounded(end, spec, part)?;
            if start > end {
                return Err(invalid(spec, part));
            }
        }
        None => {
            // A bare number with a step (`5/10`) is not valid cron.
            if step.is_some() {
                return Err(invalid(spec, part));
            }
            parse_bounded(range, spec, part)?;
        }
    }
    Ok(())
}

fn parse_bounded(value: &str, spec: &FieldSpec, part: &str) -> AppResult<u32> {
    let n: u32 = value.parse().map_err(|_| invalid(spec, part))?;
    if n < spec.min || n > spec.max {
        return Err(invalid(spec, part));
    }
    Ok(n)
}

fn invalid(spec: &FieldSpec, part: &str) -> AppError {
    AppError::Invalid(format!(
        "invalid {} in cron schedule: {part} (allowed {}-{})",
        spec.name, spec.min, spec.max
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_common_expressions() {
        for expr in [
            "* * * * *",
            "0 3 * * *",
            "0 */6 * * *",
            "0 9 * * 1-5",
            "0 3 1 * *",
            "*/15 0-6 1,15 * 0",
            "0 0 * * 7",
        ] {
            assert!(validate_cron(expr).is_ok(), "{expr} should be valid");
        }
    }

    #[test]
    fn trims_and_returns_normalized() {
        assert_eq!(validate_cron("  0 3 * * *  ").unwrap(), "0 3 * * *");
    }

    #[test]
    fn rejects_malformed_expressions() {
        for expr in [
            "",
            "* * * *",
            "* * * * * *",
            "60 * * * *",
            "* 24 * * *",
            "* * 0 * *",
            "* * * 13 *",
            "* * * * 8",
            "*/0 * * * *",
            "5-1 * * * *",
            "abc * * * *",
            "5/10 * * * *",
            "* * * * 1-",
        ] {
            assert!(validate_cron(expr).is_err(), "{expr} should be invalid");
        }
    }
}
