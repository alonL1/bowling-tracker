import RecordUploadSection from "../../../components/features/log/RecordUploadSection";

export default function UploadSessionPage() {
  return (
    <RecordUploadSection
      title="Upload a Session"
      mode="new"
      submitHelperText="All of these games will go into one session."
    />
  );
}
