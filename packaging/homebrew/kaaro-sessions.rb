class KaaroSessions < Formula
  desc "Live multi-harness AI coding session observability surface"
  homepage "https://github.com/karx/kaaroSessions"
  url "https://github.com/karx/kaaroSessions/archive/refs/tags/v1.1.0.tar.gz"
  sha256 "TODO_RELEASE_SHA256"
  license "AGPL-3.0-or-later"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"serve.mjs" => "kaaro-sessions"
  end

  test do
    assert_match "kaaro-sessions 1.1.0", shell_output("#{bin}/kaaro-sessions --version")
  end
end
