#[derive(Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            match std::str::from_utf8(&self.pending[consumed..]) {
                Ok(text) => {
                    output.push_str(text);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    output
                        .push_str(std::str::from_utf8(&self.pending[consumed..valid_end]).unwrap());
                    consumed = valid_end;
                    match error.error_len() {
                        Some(length) => {
                            output.push('\u{fffd}');
                            consumed += length;
                        }
                        None => break,
                    }
                }
            }
        }
        self.pending.drain(..consumed);
        output
    }

    pub fn finish(&mut self) -> String {
        let output = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        output
    }
}

pub fn append_tail(output: &mut String, chunk: &str, limit: usize) {
    output.push_str(chunk);
    if output.len() > limit {
        let mut start = output.len() - limit;
        while !output.is_char_boundary(start) {
            start += 1;
        }
        output.drain(..start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_characters_split_across_reads() {
        let mut decoder = Utf8Decoder::default();
        let bytes = "中文🙂".as_bytes();
        let mut output = String::new();
        for byte in bytes {
            output.push_str(&decoder.push(&[*byte]));
        }
        output.push_str(&decoder.finish());
        assert_eq!(output, "中文🙂");
    }

    #[test]
    fn replaces_invalid_and_incomplete_sequences() {
        let mut decoder = Utf8Decoder::default();
        assert_eq!(decoder.push(&[0xff, b'a', 0xe4]), "\u{fffd}a");
        assert_eq!(decoder.finish(), "\u{fffd}");
        assert_eq!(decoder.push(b"ok"), "ok");
    }

    #[test]
    fn retains_the_latest_output_at_character_boundaries() {
        let mut output = "prefix".to_string();
        append_tail(&mut output, "中文failure", 9);
        assert_eq!(output, "failure");
    }
}
