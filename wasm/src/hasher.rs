use sha2::{Digest, Sha256};

/// SHA256ハッシュを計算し、16進数文字列として返す
///
/// # Arguments
/// * `data` - ハッシュ化するバイトデータ
///
/// # Returns
/// SHA256ハッシュの16進数文字列
pub fn calculate_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_hash() {
        let data = b"test data";
        let hash = calculate_hash(data);

        // SHA256は64文字の16進数文字列を返す
        assert_eq!(hash.len(), 64);

        // 同じデータからは同じハッシュが得られる
        assert_eq!(hash, calculate_hash(data));
    }

    #[test]
    fn test_different_data_different_hash() {
        let hash1 = calculate_hash(b"data1");
        let hash2 = calculate_hash(b"data2");

        assert_ne!(hash1, hash2);
    }
}
